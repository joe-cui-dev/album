import { useCallback, useEffect, useRef, useState } from "react";
import type { AlbumNavigationResponse } from "@album/shared";
import { AlbumTransportError, type AlbumTransportErrorCode } from "../../lib/albumTransport.js";
import { createHttpAlbumNavigationPort } from "./albumNavigationPort.js";

export interface UseAlbumNavigationResult {
  data?: AlbumNavigationResponse;
  error?: AlbumTransportErrorCode;
  refresh(): void;
}

export const useAlbumNavigation = (): UseAlbumNavigationResult => {
  const [data, setData] = useState<AlbumNavigationResponse>();
  const [error, setError] = useState<AlbumTransportErrorCode>();
  const portRef = useRef(createHttpAlbumNavigationPort());
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    portRef.current
      .loadAlbumNavigation({ signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) {
          setData(response);
          setError(undefined);
        }
      })
      .catch((thrown: unknown) => {
        if (!controller.signal.aborted) {
          setError(thrown instanceof AlbumTransportError ? thrown.code : "unexpected");
        }
      });
    return () => controller.abort();
  }, [refreshToken]);

  const refresh = useCallback(() => setRefreshToken((current) => current + 1), []);

  return { ...(data ? { data } : {}), ...(error ? { error } : {}), refresh };
};
