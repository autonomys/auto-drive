export const Disclaimer = () => {
  return (
    <div className="border border-red-300 bg-red-50 bg-opacity-60 rounded-lg p-4 relative">
      <h3 className="font-semibold mb-2">Please, note:</h3>
      <ul className="list-disc list-inside space-y-1 text-sm">
        <li>Files at this stage cannot be encrypted</li>
        <li>Uploaded content will be visible and searchable by everyone</li>
        <li>Anyone can download your files</li>
        <li>Storage is permanent and irreversible</li>
      </ul>
    </div>
  );
};
