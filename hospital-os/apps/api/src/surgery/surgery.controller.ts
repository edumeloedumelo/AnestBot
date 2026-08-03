import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { AuthGuard, CurrentUser, Roles } from "../identity/auth.guard";
import { AuthenticatedUser } from "../identity/auth.service";
import { ChecklistAnswer, ChecklistPhase, ChecklistService } from "./checklist.service";
import { CaseStatus, Laterality, SurgeryService, TeamRole } from "./surgery.service";

class TeamMemberDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsIn(["surgeon", "anesthesiologist", "assistant", "nurse", "instrumentator"])
  role!: TeamRole;

  @IsOptional()
  @IsUUID()
  userId?: string;
}

class CreateRequestDto {
  @IsUUID()
  patientId!: string;

  @IsOptional()
  @IsUUID()
  insurerId?: string;

  @IsIn(["left", "right", "bilateral", "not_applicable"])
  laterality!: Laterality;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  procedureCodeIds!: string[];

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => TeamMemberDto)
  team!: TeamMemberDto[];

  @IsInt()
  @Min(1)
  expectedDurationMin!: number;
}

class ScheduleDto {
  @IsUUID()
  roomId!: string;

  @IsDateString()
  start!: string;

  @IsDateString()
  end!: string;
}

class CriticalItemsDto {
  @IsOptional()
  @IsIn(["not_needed", "requested", "confirmed"])
  opmeStatus?: "not_needed" | "requested" | "confirmed";

  @IsOptional()
  @IsIn(["not_needed", "reserved"])
  bloodReserve?: "not_needed" | "reserved";

  @IsOptional()
  @IsIn(["not_needed", "reserved"])
  icuReserve?: "not_needed" | "reserved";

  @IsOptional()
  @IsBoolean()
  consentRegistered?: boolean;
}

class TransitionDto {
  @IsIn(["authorized", "in_preparation", "in_room", "in_pacu", "completed"])
  to!: CaseStatus;

  @IsOptional()
  @IsString()
  justification?: string;
}

class CancelDto {
  @IsString()
  @MinLength(5)
  reason!: string;
}

class ChecklistAnswerDto {
  @IsString()
  @IsNotEmpty()
  item!: string;

  @IsIn(["yes", "no", "not_applicable"])
  answer!: "yes" | "no" | "not_applicable";

  @IsOptional()
  @IsString()
  justification?: string;
}

class ExecuteChecklistDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ChecklistAnswerDto)
  answers!: ChecklistAnswer[];
}

@Controller("surgery-cases")
@UseGuards(AuthGuard)
export class SurgeryController {
  constructor(
    private readonly surgery: SurgeryService,
    private readonly checklist: ChecklistService
  ) {}

  @Post(":id/checklist/:phase")
  executeChecklist(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("phase") phase: ChecklistPhase,
    @Body() dto: ExecuteChecklistDto
  ) {
    return this.checklist.executePhase({
      tenantId: user.tenantId,
      caseId: id,
      phase,
      answers: dto.answers,
      executedBy: user.userId,
    });
  }

  @Get(":id/checklist")
  checklistAdherence(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.checklist.adherence(user.tenantId, id);
  }

  @Post()
  @Roles("admin", "reception", "surgeon", "physician")
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRequestDto) {
    return this.surgery.createRequest({ tenantId: user.tenantId, createdBy: user.userId, ...dto });
  }

  @Get(":id")
  journey(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.surgery.getJourney(user.tenantId, id);
  }

  @Post(":id/schedule")
  @Roles("admin", "reception", "nurse")
  async schedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ScheduleDto
  ) {
    await this.surgery.schedule({ tenantId: user.tenantId, caseId: id, scheduledBy: user.userId, ...dto });
    return { scheduled: true };
  }

  @Post(":id/critical-items")
  @Roles("admin", "reception", "nurse")
  async criticalItems(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CriticalItemsDto
  ) {
    await this.surgery.updateCriticalItems({ tenantId: user.tenantId, caseId: id, updatedBy: user.userId, ...dto });
    return { updated: true };
  }

  @Post(":id/confirm")
  @Roles("admin", "reception", "nurse")
  async confirm(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.surgery.confirm({ tenantId: user.tenantId, caseId: id, confirmedBy: user.userId });
    return { confirmed: true };
  }

  @Post(":id/transition")
  async transition(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: TransitionDto
  ) {
    await this.surgery.transition({ tenantId: user.tenantId, caseId: id, changedBy: user.userId, ...dto });
    return { transitioned: true };
  }

  @Post(":id/cancel")
  async cancel(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    await this.surgery.cancel({ tenantId: user.tenantId, caseId: id, cancelledBy: user.userId, reason: dto.reason });
    return { cancelled: true };
  }
}
