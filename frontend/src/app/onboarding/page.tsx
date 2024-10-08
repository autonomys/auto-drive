"use client";

import { Button, Input } from "@headlessui/react";
import { Fragment, useCallback, useState } from "react";
import { NoUploadsPlaceholder } from "../../components/Files/NoUploadsPlaceholder";
import { ApiService } from "../../services/api";

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [handle, setHandle] = useState("@");

  const updateHandleValue = useCallback((value: string) => {
    if (value.startsWith("@")) {
      setHandle(value);
    } else {
      setHandle("@");
    }
  }, []);

  const handleContinue = useCallback(() => {
    setStep(step + 1);
  }, [step]);

  const updateUserHandle = useCallback(async () => {
    ApiService.updateUserHandle(handle)
      .then(() => {
        window.location.assign("/drive");
      })
      .catch((error) => {
        console.error(error);
      });
  }, [handle]);

  const steps = [
    <Fragment>
      <NoUploadsPlaceholder />
      <Button
        className="bg-black text-white rounded p-1 hover:bg-gray-800 hover:scale-105 transition-all duration-300"
        onClick={handleContinue}
      >
        I understand
      </Button>
    </Fragment>,
    <div className="flex flex-col gap-4 items-center">
      <div className="text-center">
        <p className="text-gray-600 max-w-md">
          Your handle is a unique identifier that others can use to find and
          share files with you on Auto Drive. It's an important part of your
          identity on the platform.
        </p>
      </div>
      <Input
        placeholder="Enter your handle"
        value={handle}
        onChange={(e) => updateHandleValue(e.target.value)}
        className="p-1 max-w-40 border border-gray-300 rounded-md"
      />
      <Button
        className="bg-black text-white rounded p-1 hover:bg-gray-800 hover:scale-105 transition-all duration-300"
        disabled={handle === "@"}
        onClick={updateUserHandle}
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
