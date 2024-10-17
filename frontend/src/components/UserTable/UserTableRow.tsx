import bytes from "bytes";
import { User } from "../../models/User";
import toast from "react-hot-toast";
import { Copy } from "lucide-react";

type UserTableRowProps = {
  user: User;
};

export const UserTableRow = ({ user }: UserTableRowProps) => {
  return (
    <tr>
      <td className="px-6 py-4 whitespace-nowrap">
        <div
          className="text-sm text-gray-900 flex items-center gap-2 cursor-pointer hover:text-blue-500 transition-colors duration-200"
          onClick={() => {
            if (!user.handle) return;

            navigator.clipboard.writeText(user.handle);
            toast.success("Copied to clipboard");
          }}
        >
          {user.handle} <Copy size={16} />
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm text-gray-900">{user.oauthProvider}</div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm text-gray-900">{user.oauthUserId}</div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm text-gray-900">
          {bytes(Number(user.uploadCredits), { unitSeparator: " " })}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm text-gray-900">
          {bytes(Number(user.downloadCredits), { unitSeparator: " " })}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
        <div className="flex justify-end gap-2">
          <button
            className="inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 bg-blue-100 text-blue-900 hover:bg-blue-200"
            onClick={() => {
              // TODO: Add action buttons
            }}
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
};
