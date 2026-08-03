import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from "class-validator";
import { AuthGuard, CurrentUser, Roles } from "../identity/auth.guard";
import { AuthenticatedUser } from "../identity/auth.service";
import { InsurersService } from "./insurers.service";
import { CodeSystem, ProceduresService } from "./procedures.service";

class ProcedureRowDto {
  @IsIn(["TUSS", "CBHPM", "SIGTAP", "LOCAL"])
  codeSystem!: CodeSystem;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsDateString()
  validFrom!: string;

  @IsOptional()
  @IsDateString()
  validTo?: string;
}

class ImportProceduresDto {
  @IsString()
  @IsNotEmpty()
  source!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000)
  @ValidateNested({ each: true })
  @Type(() => ProcedureRowDto)
  rows!: ProcedureRowDto[];
}

class CreateInsurerDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @Matches(/^[0-9]{6}$/, { message: "Registro ANS deve ter 6 dígitos" })
  ansCode?: string;
}

@Controller()
@UseGuards(AuthGuard)
export class MasterDataController {
  constructor(
    private readonly procedures: ProceduresService,
    private readonly insurers: InsurersService
  ) {}

  @Get("procedures")
  searchProcedures(
    @CurrentUser() user: AuthenticatedUser,
    @Query("query") query = "",
    @Query("date") date?: string
  ) {
    return this.procedures.search(user.tenantId, query, date);
  }

  @Get("procedures/:codeSystem/:code/history")
  procedureHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param("codeSystem") codeSystem: CodeSystem,
    @Param("code") code: string
  ) {
    return this.procedures.history(user.tenantId, codeSystem, code);
  }

  @Post("procedures/import")
  @Roles("admin")
  importProcedures(@CurrentUser() user: AuthenticatedUser, @Body() dto: ImportProceduresDto) {
    return this.procedures.import({
      tenantId: user.tenantId,
      source: dto.source,
      rows: dto.rows,
      importedBy: user.userId,
    });
  }

  @Get("insurers")
  listInsurers(@CurrentUser() user: AuthenticatedUser, @Query("includeInactive") includeInactive?: string) {
    return this.insurers.list(user.tenantId, includeInactive === "true");
  }

  @Post("insurers")
  @Roles("admin")
  createInsurer(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInsurerDto) {
    return this.insurers.create({ tenantId: user.tenantId, name: dto.name, ansCode: dto.ansCode, createdBy: user.userId });
  }

  @Post("insurers/:id/deactivate")
  @Roles("admin")
  async deactivateInsurer(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.insurers.deactivate({ tenantId: user.tenantId, insurerId: id, deactivatedBy: user.userId });
    return { deactivated: true };
  }
}
