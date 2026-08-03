import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { AuthenticatedUser } from "./auth.service";
import { Role } from "./users.service";

const ROLES_KEY = "required_roles";

/** Restringe a rota a papéis específicos (RBAC contextual, F1-E2). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  return ctx.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>().user;
});

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }
    let payload: { sub: string; tenant: string; name: string; roles: Role[] };
    try {
      payload = await this.jwt.verifyAsync(header.slice("Bearer ".length));
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
    request.user = {
      userId: payload.sub,
      tenantId: payload.tenant,
      fullName: payload.name,
      roles: payload.roles ?? [],
    };

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.length && !required.some((role) => request.user!.roles.includes(role))) {
      throw new ForbiddenException("Insufficient role for this operation");
    }
    return true;
  }
}
