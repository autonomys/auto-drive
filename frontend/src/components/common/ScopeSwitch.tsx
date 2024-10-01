"use client";

import { Switch } from "@headlessui/react";
import { useLocalStorage } from "usehooks-ts";

export const ScopeSwitch = () => {
  const [scope, setScope] = useLocalStorage<"user" | "global">(
    "search-scope",
    "global"
  );

  return (
    <Switch
      checked={scope === "global"}
      onChange={() => {
        setScope(scope === "global" ? "user" : "global");
      }}
      className={`${
        scope === "global" ? "bg-blue-600" : "bg-gray-200"
      } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
    >
      <span
        className={`${
          scope === "global" ? "translate-x-6" : "translate-x-1"
        } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
      />
    </Switch>
  );
};
