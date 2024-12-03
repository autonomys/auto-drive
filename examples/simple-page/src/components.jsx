import { useState } from "react";
import { uploadFileFromInput, createAutoDriveApi } from "@autonomys/auto-drive";

const api = createAutoDriveApi({
  apiKey: "<api-key>",
  url: "https://demo.auto-drive.autonomys.xyz/api",
});

export const Component = () => {
  const [file, setFile] = useState(null);

  const onUpload = async () => {
    const result = await uploadFileFromInput(api, file, {
      password: undefined,
      compression: true,
    }).promise;

    alert(`File uploaded: ${result.cid}`);
  };

  return (
    <div>
      <input type="file" onChange={(e) => setFile(e.target.files[0])} />
      <button onClick={onUpload}>Upload</button>
    </div>
  );
};
