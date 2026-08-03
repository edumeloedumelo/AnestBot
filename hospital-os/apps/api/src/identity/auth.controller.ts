import { Body, Controller, Ip, Post, UseGuards } from "@nestjs/common";
import { IsNotEmpty, IsOptional, IsString, IsUUID, MinLength } from "class-validator";
import { AuthGuard, CurrentUser } from "./auth.guard";
import { AuthService, AuthenticatedUser } from "./auth.service";

class LoginDto {
  @IsUUID()
  tenantId!: string;

  @IsString()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  totpCode?: string;
}

class ActivateMfaDto {
  @IsString()
  @IsNotEmpty()
  code!: string;
}

class EmergencyAccessDto {
  @IsString()
  @IsNotEmpty()
  resourceType!: string;

  @IsString()
  @IsNotEmpty()
  resourceId!: string;

  @IsString()
  @MinLength(10, { message: "A justificativa do acesso emergencial é obrigatória (mínimo 10 caracteres)" })
  justification!: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.auth.login({ ...dto, sourceIp: ip });
  }

  @UseGuards(AuthGuard)
  @Post("mfa/enroll")
  enrollMfa(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.enrollMfa(user.tenantId, user.userId);
  }

  @UseGuards(AuthGuard)
  @Post("mfa/activate")
  async activateMfa(@CurrentUser() user: AuthenticatedUser, @Body() dto: ActivateMfaDto) {
    await this.auth.activateMfa(user.tenantId, user.userId, dto.code);
    return { activated: true };
  }

  @UseGuards(AuthGuard)
  @Post("emergency-access")
  emergencyAccess(@CurrentUser() user: AuthenticatedUser, @Body() dto: EmergencyAccessDto, @Ip() ip: string) {
    return this.auth.emergencyAccess({
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.roles.join(","),
      resourceType: dto.resourceType,
      resourceId: dto.resourceId,
      justification: dto.justification,
      sourceIp: ip,
    });
  }
}
