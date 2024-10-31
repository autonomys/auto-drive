import { UserTableRow } from "./UserTableRow";
import { SubscriptionWithUser } from "../../models/Subscriptions";
import {
  TableBody,
  TableBodyCell,
  TableBodyRow,
} from "../common/Table/TableBody";
import { Table } from "../common/Table";
import {
  TableHead,
  TableHeadRow,
  TableHeadCell,
} from "../common/Table/TableHead";
import { Loader } from "lucide-react";

export const UserSubscriptionsTable = ({
  users,
}: {
  users: SubscriptionWithUser[] | undefined;
}) => {
  return (
    <div>
      <div className="-my-2 sm:-mx-6 lg:-mx-8">
        <div className="py-2 align-middle inline-block min-w-full sm:px-6 lg:px-8">
          <div className="shadow border-b border-gray-200 sm:rounded-lg">
            <Table className="min-w-full">
              <TableHead>
                <TableHeadRow>
                  <TableHeadCell>Public ID</TableHeadCell>
                  <TableHeadCell>Provider</TableHeadCell>
                  <TableHeadCell>Role</TableHeadCell>
                  <TableHeadCell>Granularity</TableHeadCell>
                  <TableHeadCell>Upload Credits</TableHeadCell>
                  <TableHeadCell>Download Credits</TableHeadCell>
                  <TableHeadCell>Actions</TableHeadCell>
                </TableHeadRow>
              </TableHead>
              <TableBody>
                {users?.map((user) => (
                  <UserTableRow key={user.id} subscriptionWithUser={user} />
                ))}
                {users === undefined && (
                  <TableBodyRow>
                    <TableBodyCell
                      colSpan={7}
                      className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center"
                    >
                      <span className="flex justify-center items-center">
                        <Loader className="w-4 h-4 animate-spin" />
                      </span>
                    </TableBodyCell>
                  </TableBodyRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
};
