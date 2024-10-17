import { OffchainMetadata } from "@autonomys/auto-drive";

export const uploadFileContent = (file: File) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Data = e.target?.result as string;
      const data = base64Data.split(",")[1];
      resolve(data);
    };
    reader.readAsDataURL(file);
  });
};

export const handleFileDownload = (
  blob: Blob,
  type: OffchainMetadata["type"],
  name: string
) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = type === "file" ? name : `${name}.zip`;
  document.body.appendChild(a);
  a.click();

  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
};
