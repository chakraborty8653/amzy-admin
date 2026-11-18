package com.chakrabortycompliance.amzy.telegram;

import android.net.Uri;

import androidx.media3.common.C;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.TransferListener;

import org.drinkless.tdlib.Client;
import org.drinkless.tdlib.TdApi;

import java.io.IOException;
import java.io.RandomAccessFile;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

final class TelegramRangeDataSource implements DataSource {
    private static final int CHUNK_SIZE = 1024 * 1024;
    private static final long DOWNLOAD_TIMEOUT_SECONDS = 90;

    interface ClientProvider {
        Client getReadyClient() throws IOException;
    }

    interface StreamListener {
        void onBytesRead(long bytesRead);
    }

    static final class Factory implements DataSource.Factory {
        private final ClientProvider clientProvider;
        private final StreamListener streamListener;
        private final int fileId;
        private final long fileSize;
        private final Object rangeLock = new Object();

        Factory(ClientProvider clientProvider, StreamListener streamListener, int fileId, long fileSize) {
            this.clientProvider = clientProvider;
            this.streamListener = streamListener;
            this.fileId = fileId;
            this.fileSize = fileSize;
        }

        @Override
        public DataSource createDataSource() {
            return new TelegramRangeDataSource(clientProvider, streamListener, fileId, fileSize, rangeLock);
        }
    }

    private final ClientProvider clientProvider;
    private final StreamListener streamListener;
    private final int fileId;
    private final long fileSize;
    private final Object rangeLock;
    private Uri uri;
    private DataSpec dataSpec;
    private long position;
    private long bytesRemaining;
    private final byte[] readBuffer = new byte[CHUNK_SIZE];
    private int readBufferOffset;
    private int readBufferLength;
    private boolean opened;
    private volatile boolean closed;
    private TransferListener transferListener;

    private TelegramRangeDataSource(
        ClientProvider clientProvider,
        StreamListener streamListener,
        int fileId,
        long fileSize,
        Object rangeLock
    ) {
        this.clientProvider = clientProvider;
        this.streamListener = streamListener;
        this.fileId = fileId;
        this.fileSize = fileSize;
        this.rangeLock = rangeLock;
    }

    @Override
    public long open(DataSpec dataSpec) throws IOException {
        this.dataSpec = dataSpec;
        uri = dataSpec.uri;
        position = dataSpec.position;
        readBufferOffset = 0;
        readBufferLength = 0;
        if (position < 0 || position > fileSize) {
            throw new IOException("Telegram video byte range is outside the file.");
        }
        bytesRemaining = dataSpec.length == C.LENGTH_UNSET
            ? fileSize - position
            : Math.min(dataSpec.length, fileSize - position);
        opened = true;
        closed = false;
        return bytesRemaining;
    }

    @Override
    public int read(byte[] buffer, int offset, int length) throws IOException {
        synchronized (rangeLock) {
            return readLocked(buffer, offset, length);
        }
    }

    private int readLocked(byte[] buffer, int offset, int length) throws IOException {
        if (closed) throw new IOException("Telegram video stream was closed.");
        if (!opened) throw new IOException("Telegram video stream is not open.");
        if (length == 0) return 0;
        if (bytesRemaining == 0) return C.RESULT_END_OF_INPUT;

        if (readBufferOffset == readBufferLength) {
            readBufferOffset = 0;
            TdApi.File file = awaitRange(position, (int) Math.min(CHUNK_SIZE, bytesRemaining));
            readBufferLength = copyAvailableBytes(
                file,
                position,
                (int) Math.min(CHUNK_SIZE, bytesRemaining),
                readBuffer,
                0
            );
            if (readBufferLength <= 0) {
                throw new IOException("Telegram returned no bytes for video offset " + position + ".");
            }
        }
        int bytesToCopy = Math.min(
            Math.min(length, readBufferLength - readBufferOffset),
            (int) Math.min(Integer.MAX_VALUE, bytesRemaining)
        );
        System.arraycopy(readBuffer, readBufferOffset, buffer, offset, bytesToCopy);
        readBufferOffset += bytesToCopy;
        position += bytesToCopy;
        bytesRemaining -= bytesToCopy;
        if (transferListener != null) {
            transferListener.onBytesTransferred(this, dataSpec, true, bytesToCopy);
        }
        streamListener.onBytesRead(bytesToCopy);
        return bytesToCopy;
    }

    private TdApi.File awaitRange(long offset, int length) throws IOException {
        Client client = clientProvider.getReadyClient();
        TdApi.File file = requestFile(client, new TdApi.GetFile(fileId), 15);
        if (hasRequestedBytes(file, offset)) return file;

        long rangeLength = Math.min(Math.max((long) length, CHUNK_SIZE), fileSize - offset);
        file = requestFile(
            client,
            new TdApi.DownloadFile(fileId, 32, offset, rangeLength, false),
            15
        );
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(DOWNLOAD_TIMEOUT_SECONDS);
        while (!closed && System.nanoTime() < deadline) {
            if (hasRequestedBytes(file, offset)) return file;
            try {
                Thread.sleep(200);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new IOException("Telegram video range request was interrupted.", error);
            }
            file = requestFile(client, new TdApi.GetFile(fileId), 15);
        }
        if (closed) throw new IOException("Telegram video stream was closed.");
        long availableStart = file.local == null ? -1 : file.local.downloadOffset;
        long availablePrefix = file.local == null ? 0 : file.local.downloadedPrefixSize;
        long cachedSize = file.local == null ? 0 : file.local.downloadedSize;
        throw new IOException(
            "Telegram range timeout at byte " + offset
                + " (available range starts at " + availableStart
                + ", prefix " + availablePrefix
                + ", cached " + cachedSize + " bytes)."
        );
    }

    private TdApi.File requestFile(
        Client client,
        TdApi.Function<TdApi.File> request,
        long timeoutSeconds
    ) throws IOException {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<TdApi.Object> result = new AtomicReference<>();
        client.send(request, response -> {
            result.set(response);
            latch.countDown();
        });
        try {
            if (!latch.await(timeoutSeconds, TimeUnit.SECONDS)) {
                throw new IOException("Telegram video range request did not respond.");
            }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IOException("Telegram video range request was interrupted.", error);
        }

        TdApi.Object response = result.get();
        if (response instanceof TdApi.Error) {
            throw new IOException("Telegram range request failed: " + ((TdApi.Error) response).message);
        }
        if (!(response instanceof TdApi.File)) {
            throw new IOException("Telegram returned an unexpected video range response.");
        }
        return (TdApi.File) response;
    }

    private boolean hasRequestedBytes(TdApi.File file, long offset) {
        if (file.local == null || file.local.path == null || file.local.path.isEmpty()) return false;
        if (file.local.isDownloadingCompleted) return offset < file.size;
        long availableStart = file.local.downloadOffset;
        long availableEnd = availableStart + file.local.downloadedPrefixSize;
        return offset >= availableStart && offset < availableEnd;
    }

    private int copyAvailableBytes(
        TdApi.File file,
        long requestedPosition,
        int requestedLength,
        byte[] target,
        int targetOffset
    ) throws IOException {
        if (file.local == null || file.local.path == null || file.local.path.isEmpty()) {
            throw new IOException("Telegram did not provide the requested video data.");
        }
        long availableStart = file.local.isDownloadingCompleted ? 0 : file.local.downloadOffset;
        long availableEnd = file.local.isDownloadingCompleted
            ? fileSize
            : availableStart + file.local.downloadedPrefixSize;
        long actualEnd = Math.min(requestedPosition + requestedLength, availableEnd);
        if (requestedPosition < availableStart || actualEnd <= requestedPosition) {
            throw new IOException("Telegram has not downloaded the requested video segment.");
        }

        int actualLength = (int) (actualEnd - requestedPosition);
        try (RandomAccessFile source = new RandomAccessFile(file.local.path, "r")) {
            source.seek(requestedPosition);
            source.readFully(target, targetOffset, actualLength);
        }
        return actualLength;
    }

    @Override
    public Uri getUri() {
        return uri;
    }

    @Override
    public Map<String, List<String>> getResponseHeaders() {
        return Collections.emptyMap();
    }

    @Override
    public void addTransferListener(TransferListener listener) {
        transferListener = listener;
    }

    @Override
    public void close() {
        closed = true;
        opened = false;
        readBufferOffset = 0;
        readBufferLength = 0;
        uri = null;
        dataSpec = null;
    }
}
