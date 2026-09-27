import { useState } from "react";
import { toast } from "sonner";

//onboarding eg=> onboardingFn(payload)  →  fn(payload)  →  cb(payload)  →  completeOnboarding(payload)
// its just wht fn is gttng it is passing onto cb which is completeOnboarding here by spreading the arguments..

export const useFetch = (cb) => {
  const [data, setData] = useState(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fn = async (...args) => {
    setLoading(true);
    setError(null);

    try {
      const response = await cb(...args);
      setData(response);
      setError(null);
    } catch (error) {
      toast.error(error.message);
      setError(error);
    } finally {
      setLoading(false);
    }
  };

  return {data, setData, loading, error, fn};
};
