"use client";

import { Toggle } from "./Toggle";
import { useScopeStore } from "../../states/scope";

export const ScopeSwitch = () => {
  const scope = useScopeStore(({ scope }) => scope);
  const setScope = useScopeStore(({ setScope }) => setScope);

  return (
    <Toggle
      value={scope === "global"}
      onUpdate={(isGlobal) => setScope(isGlobal ? "global" : "user")}
    />
  );
};
