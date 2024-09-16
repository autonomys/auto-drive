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
