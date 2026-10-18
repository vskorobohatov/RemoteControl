import type { AuthStatusResponse, LoginResponse, SessionResponse } from "@server/types";
import { json, request } from "@shared/api/client";

export function fetchAuthStatus(): Promise<AuthStatusResponse> {
  return request<AuthStatusResponse>("/api/auth/status");
}

export function bootstrapAccount(login: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>("/api/auth/bootstrap", json("POST", { login, password }));
}

export function login(login: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>("/api/auth/login", json("POST", { login, password }));
}

export function logout(): Promise<void> {
  return request<void>("/api/auth/logout", { method: "POST" });
}

export function fetchSession(): Promise<SessionResponse> {
  return request<SessionResponse>("/api/auth/session");
}
