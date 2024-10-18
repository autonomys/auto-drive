"use client";

import { useEffect, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import { Toggle } from "./Toggle";

export const ScopeSwitch = () => {
  const [global, setGlobal] = useState(false);
  const [scope, setScope] = useLocalStorage<"user" | "global">(
    "search-scope",
    "global"
  );

  useEffect(() => {
    setScope(global ? "global" : "user");
  }, [global]);

  useEffect(() => {
    setGlobal(scope === "global");
  }, []);

  return <Toggle value={global} onUpdate={setGlobal} />;
};
