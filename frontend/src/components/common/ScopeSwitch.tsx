"use client";

import { Toggle } from "./Toggle";
import { useScopeStore } from "../../states/scope";

export const ScopeSwitch = () => {
  const { scope, setScope } = useScopeStore();

  return (
    <Toggle
      value={scope === "global"}
      onUpdate={(isGlobal) => setScope(isGlobal ? "global" : "user")}
    />
  );
};
