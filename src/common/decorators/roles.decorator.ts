import { SetMetadata } from '@nestjs/common';

export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

export const ROLES_KEY = 'roles';
export const Roles = (...roles: (UserRole | 'USER' | 'ADMIN')[]) =>
  SetMetadata(ROLES_KEY, roles);
