import { io } from "socket.io-client";
import { backendUrl } from "./api";

export const createSocket = () =>
  io(backendUrl, {
    withCredentials: true,
    transports: ["websocket"]
  });
