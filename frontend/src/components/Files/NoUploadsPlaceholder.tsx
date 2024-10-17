import { Disclaimer } from "../common/Disclaimer";

export const NoUploadsPlaceholder = () => {
  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded-lg">
      <h2 className="text-2xl font-bold mb-4 text-center">
        Make your first upload
      </h2>
      <p className="text-center mb-6">
        Use it as regular cloud storage, but with the guarantee
        <br></br>
        that your data will never be lost.
      </p>
      <Disclaimer />
    </div>
  );
};
