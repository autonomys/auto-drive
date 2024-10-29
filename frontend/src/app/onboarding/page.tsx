"use client";

import { Button, Input } from "@headlessui/react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { NoUploadsPlaceholder } from "../../components/Files/NoUploadsPlaceholder";
import { ApiService } from "../../services/api";

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const onboardUser = useCallback(async () => {
    ApiService.onboardUser()
      .then(() => {
        window.location.assign("/drive");
      })
      .catch((error) => {
        console.error(error);
      });
  }, []);

  const steps = [
    <div className="flex flex-col gap-4 items-center">
      <NoUploadsPlaceholder />
      <Button
        className={`bg-black text-white rounded p-1 transition-all duration-300 opacity-100 hover:bg-gray-800 hover:scale-105`}
        onClick={onboardUser}
      >
        Continue
      </Button>
    </div>,
  ];

  const currentStep = steps[step];

  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <header className="flex flex-col md:flex-row gap-4 md:gap-0 items-center justify-between mb-8">
        <div className="flex items-center space-x-2">
          <img
            src="/autonomys.png"
            alt="Auto Drive"
            className="w-[2rem] h-[2rem] rounded-full"
          />
          <span className="text-xl font-semibold">Auto Drive</span>
        </div>
      </header>
      {currentStep}
    </div>
  );
}
