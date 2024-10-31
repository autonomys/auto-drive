import bytes from "bytes";
import { User, UserRole } from "../../models/User";
import toast from "react-hot-toast";
import { Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { CreditsUpdateModal } from "./CreditsUpdateModal";
import { SubscriptionWithUser } from "../../models/Subscriptions";
import { UpdateRoleModal } from "./UpdateRoleModal";
import { useUserStore } from "../../states/user";
import { TableBodyCell, TableBodyRow } from "../common/Table/TableBody";
import { shortenString } from "../../utils/misc";

type UserTableRowProps = {
  subscriptionWithUser: SubscriptionWithUser;
};

export const UserTableRow = ({ subscriptionWithUser }: UserTableRowProps) => {
  const user = useUserStore(({ user }) => user);
  const [isUpdateRoleOpen, setIsUpdateRoleOpen] = useState(false);
  const [isCreditsUpdateModalOpen, setIsCreditsUpdateModalOpen] =
    useState(false);

  const granularity =
    subscriptionWithUser.granularity.charAt(0).toUpperCase() +
    subscriptionWithUser.granularity.slice(1);

  const myHandle = useMemo(() => user?.publicId, [user?.publicId]);

  return (
    <TableBodyRow>
      <CreditsUpdateModal
        onClose={() => setIsCreditsUpdateModalOpen(false)}
        userHandle={
          isCreditsUpdateModalOpen ? subscriptionWithUser.user.publicId : null
        }
      />
      <UpdateRoleModal
        userHandle={
          isUpdateRoleOpen ? subscriptionWithUser.user.publicId : null
        }
        onClose={() => setIsUpdateRoleOpen(false)}
      />
      <TableBodyCell>
        <div
          className="text-sm text-gray-900 flex items-center gap-2 cursor-pointer hover:text-blue-500 transition-colors duration-200"
          onClick={() => {
            if (!subscriptionWithUser.user.publicId) return;

            navigator.clipboard.writeText(subscriptionWithUser.user.publicId);
            toast.success("Copied to clipboard");
          }}
        >
          {shortenString(subscriptionWithUser.user.publicId!, 16)}{" "}
          <Copy size={16} />
        </div>
      </TableBodyCell>
      <TableBodyCell>
        <div className="text-sm text-gray-900">
          {subscriptionWithUser.user.oauthProvider}
        </div>
      </TableBodyCell>
      <TableBodyCell>
        <div className="text-sm text-gray-900 flex items-center gap-2">
          {subscriptionWithUser.user.role}
        </div>
      </TableBodyCell>
      <TableBodyCell>
        <div className="text-sm text-gray-900">{granularity}</div>
      </TableBodyCell>
      <TableBodyCell>
        <div className="text-sm text-gray-900">
          {bytes(Number(subscriptionWithUser.uploadLimit), {
            unitSeparator: " ",
          })}
        </div>
      </TableBodyCell>
      <TableBodyCell>
        <div className="text-sm text-gray-900">
          {bytes(Number(subscriptionWithUser.downloadLimit), {
            unitSeparator: " ",
          })}
        </div>
      </TableBodyCell>
      <TableBodyCell>
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
            disabled={myHandle === subscriptionWithUser.user.publicId}
          >
            Update role
          </button>
        </div>
      </TableBodyCell>
    </TableBodyRow>
  );
};
