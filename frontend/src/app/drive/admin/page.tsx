"use client";

import { useEffect, useState } from "react";
import { ApiService } from "../../../services/api";
import { User } from "../../../models/User";
import { UserTable } from "../../../components/UserTable";

export default function Page() {
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    ApiService.getUserList().then(setUsers);
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Users</h1>
      <div className="flex flex-col gap-2">
        <UserTable users={users} />
      </div>
    </div>
  );
}
