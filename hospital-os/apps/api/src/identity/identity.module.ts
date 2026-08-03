import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { UsersService } from "./users.service";

const ACCESS_TOKEN_TTL = "15m";

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
          throw new Error("JWT_SECRET environment variable is required");
        }
        return { secret, signOptions: { expiresIn: ACCESS_TOKEN_TTL } };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, UsersService, AuthGuard],
  exports: [AuthService, UsersService, AuthGuard],
})
export class IdentityModule {}
