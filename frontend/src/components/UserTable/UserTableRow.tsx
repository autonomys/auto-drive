import bytes from "bytes";
import { User, UserRole } from "../../models/User";
import toast from "react-hot-toast";
import { Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { CreditsUpdateModal } from "./CreditsUpdateModal";
import { SubscriptionWithUser } from "../../models/Subscriptions";
import { shortenHandle } from "../../utils/misc";
import { UpdateRoleModal } from "./UpdateRoleModal";
import { useUserStore } from "../../states/user";

type UserTableRowProps = {
  subscriptionWithUser: SubscriptionWithUser;
};

export const UserTableRow = ({ subscriptionWithUser }: UserTableRowProps) => {
  const { user } = useUserStore();
  const [isUpdateRoleOpen, setIsUpdateRoleOpen] = useState(false);
  const [isCreditsUpdateModalOpen, setIsCreditsUpdateModalOpen] =
    useState(false);

  const granularity =
    subscriptionWithUser.granularity.charAt(0).toUpperCase() +
    subscriptionWithUser.granularity.slice(1);

  const myHandle = useMemo(() => user?.handle, [user?.handle]);

  return (
    <tr>
      <CreditsUpdateModal
        onClose={() => setIsCreditsUpdateModalOpen(false)}
        userHandle={
          isCreditsUpdateModalOpen ? subscriptionWithUser.user.handle : null
        }
      />
      <UpdateRoleModal
        userHandle={isUpdateRoleOpen ? subscriptionWithUser.user.handle : null}
        onClose={() => setIsUpdateRoleOpen(false)}
      />
      <td className="px-6 py-4 whitespace-nowrap">
        <div
          className="text-sm text-gray-900 flex items-center gap-2 cursor-pointer hover:text-blue-500 transition-colors duration-200"
          onClick={() => {
            if (!subscriptionWithUser.user.handle) return;

            navigator.clipboard.writeText(subscriptionWithUser.user.handle);
            toast.success("Copied to clipboard");
          }}
        >
          {shortenHandle(subscriptionWithUser.user.handle!)} <Copy size={16} />
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm text-gray-900">
          {subscriptionWithUser.user.oauthProvider}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm text-gray-900 flex items-center gap-2">
          {subscriptionWithUser.user.role}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm text-gray-900">{granularity}</div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm text-gray-900">
          {bytes(Number(subscriptionWithUser.uploadLimit), {
            unitSeparator: " ",
          })}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm text-gray-900">
          {bytes(Number(subscriptionWithUser.downloadLimit), {
            unitSeparator: " ",
          })}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
        <div className="flex flex-col justify-end gap-2">
          <button
            className="inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 bg-blue-100 text-blue-900 hover:bg-blue-200"
            onClick={() => {
              setIsCreditsUpdateModalOpen(true);
            }}
          >
            Update plan
          </button>
          <button
            className="inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 bg-blue-100 text-blue-900 hover:bg-blue-200 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => {
              setIsUpdateRoleOpen(true);
            }}
            disabled={myHandle === subscriptionWithUser.user.handle}
          >
            Update role
          </button>
        </div>
      </td>
    </tr>
  );
};
