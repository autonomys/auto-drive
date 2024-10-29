"use client";

import { Button, Input } from "@headlessui/react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ApiService } from "../../services/api";
import { Loader } from "lucide-react";

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const onboardUser = useCallback(async () => {
    setIsLoading(true);
    ApiService.onboardUser()
      .then(() => {
        window.location.assign("/drive");
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const nextStep = useCallback(() => {
    setTransitioning(true);
    setTimeout(() => {
      setStep((a) => a + 1);
      setTransitioning(false);
    }, 300); // Match this duration with the CSS transition duration
  }, []);

  const steps = [
    <div className="flex flex-col gap-4 items-center">
      <span className="text-2xl font-bold">Welcome to Auto Drive</span>
      <span className="w-[20rem] text-sm text-gray-500 text-center">
        Auto-Drive is a file storage and sharing service that allows you to
        store and share files with others.
      </span>
      <Button
        className={`bg-black font-semibold text-white rounded px-4 py-1 transition-all duration-300 opacity-100 hover:bg-gray-800 hover:scale-105`}
        onClick={nextStep}
      >
        Start
      </Button>
    </div>,
    <div className="flex flex-col gap-4 items-center">
      <span className="text-2xl font-bold">Terms of Service</span>
      <span className="text-sm text-gray-500">
        Auto-Drive <strong>is public by default.</strong>
      </span>
      <span className="text-sm text-gray-500">
        You <strong>can setup encryption</strong> but the encrypted file would
        be public.
      </span>
      <Button
        className={`bg-black font-semibold text-white rounded px-4 py-1 transition-all duration-300 opacity-100 hover:bg-gray-800 hover:scale-105`}
        onClick={nextStep}
      >
        Accept
      </Button>
    </div>,
    <div className="flex flex-col gap-4 items-center">
      <span className="text-2xl font-bold">Terms of Service</span>
      <span className="text-sm text-gray-500">
        Auto-Drive saves files in Autonomy's network so files{" "}
        <strong>won't be able to be deleted</strong> by anyone.
      </span>
      <Button
        className={`bg-black font-semibold text-white rounded px-4 py-1 transition-all duration-300 opacity-100 hover:bg-gray-800 hover:scale-105`}
        onClick={onboardUser}
      >
        {isLoading ? <Loader className="w-4 h-4 animate-spin" /> : "Accept"}
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
      <div
        className={`transition-opacity duration-300 ${
          transitioning ? "opacity-0" : "opacity-100"
        }`}
      >
        {currentStep}
      </div>
    </div>
  );
}
