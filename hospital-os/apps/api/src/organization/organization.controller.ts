import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from "class-validator";
import { AuthGuard, CurrentUser, Roles } from "../identity/auth.guard";
import { AuthenticatedUser } from "../identity/auth.service";
import { OrgUnitKind, OrganizationService } from "./organization.service";

class CreateOrgUnitDto {
  @IsIn(["organization", "unit", "sector", "room", "bed"])
  kind!: OrgUnitKind;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

@Controller("org-units")
@UseGuards(AuthGuard)
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.organization.list(user.tenantId);
  }

  @Post()
  @Roles("admin")
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOrgUnitDto) {
    return this.organization.create({
      tenantId: user.tenantId,
      kind: dto.kind,
      name: dto.name,
      parentId: dto.parentId ?? null,
      createdBy: user.userId,
    });
  }
}
