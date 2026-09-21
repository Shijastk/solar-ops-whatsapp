import { getIngestionEnv } from "@/lib/env";

type MetaMediaMetadata = {
  id: string;
  url: string;
  mime_type?: string;
  sha256?: string;
  file_size?: number;
};

export type DownloadedMedia = {
  bytes: Buffer;
  mimeType: string;
  sha256?: string;
  fileSize: number;
};

async function getMediaMetadata(mediaId: string): Promise<MetaMediaMetadata> {
  const env = getIngestionEnv();
  const response = await fetch(
    `https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${encodeURIComponent(mediaId)}`,
    {
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(
      `Meta media metadata request failed (${response.status}): ${await response.text()}`,
    );
  }

  return (await response.json()) as MetaMediaMetadata;
}

export async function downloadWhatsAppMedia(
  mediaId: string,
  fallbackMimeType?: string,
): Promise<DownloadedMedia> {
  const env = getIngestionEnv();
  const metadata = await getMediaMetadata(mediaId);

  if (metadata.file_size && metadata.file_size > env.MAX_MEDIA_BYTES) {
    throw new Error(
      `Inbound media is too large (${metadata.file_size} bytes; limit ${env.MAX_MEDIA_BYTES})`,
    );
  }

  const response = await fetch(metadata.url, {
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Meta media download failed (${response.status}): ${await response.text()}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > env.MAX_MEDIA_BYTES) {
    throw new Error(
      `Inbound media exceeded the configured limit after download (${arrayBuffer.byteLength} bytes)`,
    );
  }

  return {
    bytes: Buffer.from(arrayBuffer),
    mimeType:
      metadata.mime_type ??
      response.headers.get("content-type") ??
      fallbackMimeType ??
      "application/octet-stream",
    sha256: metadata.sha256,
    fileSize: arrayBuffer.byteLength,
  };
}
