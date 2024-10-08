"use client";

import { Button, Input } from "@headlessui/react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { NoUploadsPlaceholder } from "../../components/Files/NoUploadsPlaceholder";
import { ApiService } from "../../services/api";

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [handle, setHandle] = useState("@");
  const [isHandleAvailable, setIsHandleAvailable] = useState<boolean | null>(
    null
  );

  const updateAvailability = useCallback((handle: string) => {
    if (!handle.startsWith("@") || handle === "@") {
      setIsHandleAvailable(null);
      return;
    }

    ApiService.checkHandleAvailability(handle).then((isAvailable) => {
      setIsHandleAvailable(isAvailable);
    });
  }, []);

  useEffect(() => {
    updateAvailability(handle);
  }, [handle, updateAvailability]);

  const updateHandleValue = useCallback(
    (value: string) => {
      if (value.startsWith("@")) {
        setHandle(value);
      } else {
        setHandle("@");
      }
    },
    [updateAvailability]
  );

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

  const handleError = useMemo(() => {
    if (handle.length < 2) {
      return;
    }

    if (handle.length > 32) {
      return "Handle is too long";
    }

    if (!handle.startsWith("@")) {
      return "Handle must start with @";
    }

    if (!/^@[A-Za-z0-9_\.]+$/.test(handle)) {
      return "Handle can only contain letters, numbers, underscores and dots";
    }
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
        <p className="text-gray-600 max-w-md">
          Your handle can only contain letters, numbers, underscores and dots.
          Maximum length is 32 characters.
        </p>
      </div>
      <Input
        placeholder="Enter your handle"
        value={handle}
        onChange={(e) => updateHandleValue(e.target.value)}
        className="p-1 max-w-40 border border-gray-300 rounded-md"
      />
      {handleError && (
        <div
          className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative"
          role="alert"
        >
          <span className="block sm:inline">{handleError}</span>
        </div>
      )}
      {!handleError && isHandleAvailable && (
        <div
          className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded relative"
          role="alert"
        >
          <span className="block sm:inline">That handle is available!</span>
        </div>
      )}
      {!handleError && isHandleAvailable === false && (
        <div
          className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative"
          role="alert"
        >
          <strong className="font-bold">Oops!</strong>
          <span className="block sm:inline">
            {" "}
            That handle is already taken. Please choose another one.
          </span>
        </div>
      )}
      <Button
        className={`bg-black text-white rounded p-1 transition-all duration-300 ${
          isHandleAvailable
            ? "opacity-100 hover:bg-gray-800 hover:scale-105"
            : "opacity-50"
        }`}
        disabled={!isHandleAvailable}
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
