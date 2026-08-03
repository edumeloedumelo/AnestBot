import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from "class-validator";
import { DbService } from "../db/db.service";
import { AuthGuard, CurrentUser, Roles } from "../identity/auth.guard";
import { AuthenticatedUser } from "../identity/auth.service";
import { OrgUnitKind, OrganizationService } from "./organization.service";

/**
 * Descoberta de tenant para a tela de login (público por design: expõe
 * apenas id e nome de instituições ativas, nada clínico).
 */
@Controller("tenants")
export class TenantsController {
  constructor(private readonly db: DbService) {}

  @Get(":slug")
  async bySlug(@Param("slug") slug: string) {
    const result = await this.db.pool.query("SELECT id, name FROM tenant WHERE slug = $1 AND active", [slug]);
    if (!result.rowCount) {
      throw new NotFoundException("Instituição não encontrada");
    }
    return result.rows[0];
  }
}

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
