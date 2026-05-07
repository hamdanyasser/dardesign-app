"use client";

import React, { createContext, useContext, useState, useCallback } from "react";

type StyleId = "lebanese" | "khaleeji" | "moroccan";

interface ImageContextType {
  imageFile: File | null;
  imagePreviewUrl: string | null;
  selectedStyle: StyleId | null;
  resultImageUrl: string | null;
  jobId: string | null;
  setImage: (file: File) => void;
  clearImage: () => void;
  setSelectedStyle: (style: StyleId) => void;
  setResultImageUrl: (url: string) => void;
  setJobId: (id: string | null) => void;
  reset: () => void;
}

const ImageContext = createContext<ImageContextType | undefined>(undefined);

export function ImageProvider({ children }: { children: React.ReactNode }) {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyleState] = useState<StyleId | null>(null);
  const [resultImageUrl, setResultImageUrlState] = useState<string | null>(null);
  const [jobId, setJobIdState] = useState<string | null>(null);

  const setImage = useCallback((file: File) => {
    setImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setImageFile(file);
  }, []);

  const clearImage = useCallback(() => {
    setImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setImageFile(null);
  }, []);

  const setSelectedStyle = useCallback((style: StyleId) => {
    setSelectedStyleState(style);
  }, []);

  const setResultImageUrl = useCallback((url: string) => {
    setResultImageUrlState((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }, []);

  const setJobId = useCallback((id: string | null) => {
    setJobIdState(id);
  }, []);

  const reset = useCallback(() => {
    setImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setResultImageUrlState((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setImageFile(null);
    setSelectedStyleState(null);
    setJobIdState(null);
  }, []);

  return (
    <ImageContext.Provider
      value={{
        imageFile,
        imagePreviewUrl,
        selectedStyle,
        resultImageUrl,
        jobId,
        setImage,
        clearImage,
        setSelectedStyle,
        setResultImageUrl,
        setJobId,
        reset,
      }}
    >
      {children}
    </ImageContext.Provider>
  );
}

export function useImage() {
  const context = useContext(ImageContext);
  if (!context) {
    throw new Error("useImage must be used within an ImageProvider");
  }
  return context;
}

export type { StyleId };
