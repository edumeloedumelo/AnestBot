import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MinLength } from "class-validator";
import { AuthGuard, CurrentUser, Roles } from "../identity/auth.guard";
import { AuthenticatedUser } from "../identity/auth.service";
import { PatientsService } from "./patients.service";

class PatientIdentityDto {
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsDateString()
  birthDate!: string;

  @IsOptional()
  @IsString()
  cpf?: string;

  @IsOptional()
  @IsString()
  cns?: string;
}

class CreatePatientDto extends PatientIdentityDto {
  @IsOptional()
  @IsIn(["F", "M", "O", "U"])
  sex?: "F" | "M" | "O" | "U";

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  duplicateOverrideJustification?: string;
}

class MergePatientsDto {
  @IsUUID()
  targetId!: string;

  @IsString()
  @MinLength(10)
  justification!: string;
}

@Controller("patients")
@UseGuards(AuthGuard)
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Get()
  search(@CurrentUser() user: AuthenticatedUser, @Query("query") query = "") {
    return this.patients.search(user.tenantId, query);
  }

  @Get(":id")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.patients.get(user.tenantId, id);
  }

  @Post("duplicate-check")
  duplicateCheck(@CurrentUser() user: AuthenticatedUser, @Body() dto: PatientIdentityDto) {
    return this.patients.findDuplicates({ tenantId: user.tenantId, ...dto });
  }

  @Post()
  @Roles("admin", "reception")
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePatientDto) {
    return this.patients.create({ tenantId: user.tenantId, createdBy: user.userId, ...dto });
  }

  @Post(":id/merge")
  @Roles("admin")
  merge(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) sourceId: string,
    @Body() dto: MergePatientsDto
  ) {
    return this.patients.merge({
      tenantId: user.tenantId,
      sourceId,
      targetId: dto.targetId,
      justification: dto.justification,
      mergedBy: user.userId,
    });
  }
}
