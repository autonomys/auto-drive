import bytes from "bytes";
import { User } from "../../models/User";
import toast from "react-hot-toast";
import { Copy } from "lucide-react";
import { useState } from "react";
import { CreditsUpdateModal } from "./CreditsUpdateModal";
import { SubscriptionWithUser } from "../../models/Subscriptions";
import { shortenHandle } from "../../utils/misc";

type UserTableRowProps = {
  subscriptionWithUser: SubscriptionWithUser;
};

export const UserTableRow = ({ subscriptionWithUser }: UserTableRowProps) => {
  const [isCreditsUpdateModalOpen, setIsCreditsUpdateModalOpen] =
    useState(false);

  const granularity =
    subscriptionWithUser.granularity.charAt(0).toUpperCase() +
    subscriptionWithUser.granularity.slice(1);
  return (
    <tr>
      <CreditsUpdateModal
        onClose={() => setIsCreditsUpdateModalOpen(false)}
        userHandle={
          isCreditsUpdateModalOpen ? subscriptionWithUser.user.handle : null
        }
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
        <div
          className="text-sm text-gray-900 flex items-center gap-2 cursor-pointer hover:text-blue-500 transition-colors duration-200"
          onClick={() => {
            if (!subscriptionWithUser.user.oauthUserId) return;

            navigator.clipboard.writeText(
              subscriptionWithUser.user.oauthUserId
            );
            toast.success("Copied to clipboard");
          }}
        >
          {shortenHandle(subscriptionWithUser.user.oauthUserId!)}
          <Copy size={16} />
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
        <div className="flex justify-end gap-2">
          <button
            className="inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 bg-blue-100 text-blue-900 hover:bg-blue-200"
            onClick={() => {
              setIsCreditsUpdateModalOpen(true);
            }}
          >
            Update plan
          </button>
        </div>
      </td>
    </tr>
  );
};
