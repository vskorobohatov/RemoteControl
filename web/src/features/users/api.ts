import type { CreateUserRequest, PublicUser, UpdateUserRequest, UsersResponse } from "@server/types";
import { json, request } from "@shared/api/client";

export function fetchUsers(): Promise<UsersResponse> {
  return request<UsersResponse>("/api/users");
}

export function createUser(input: CreateUserRequest): Promise<PublicUser> {
  return request<PublicUser>("/api/users", json("POST", input));
}

export function updateUser(id: number, input: UpdateUserRequest): Promise<PublicUser> {
  return request<PublicUser>(`/api/users/${id}`, json("PATCH", input));
}

export function deleteUser(id: number): Promise<void> {
  return request<void>(`/api/users/${id}`, { method: "DELETE" });
}
