interface UploadToS3Input {
  file: File;
  uploadUrl: string;
  onProgress: (percent: number) => void;
}

export const uploadToS3 = ({
  file,
  uploadUrl,
  onProgress,
}: UploadToS3Input): Promise<void> => {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }
      onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      reject(new Error("Upload failed"));
    };
    request.onerror = () => reject(new Error("Upload failed"));

    request.open("PUT", uploadUrl);
    request.setRequestHeader("Content-Type", file.type);
    request.send(file);
  });
};
