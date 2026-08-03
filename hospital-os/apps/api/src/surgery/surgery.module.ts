import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { ChecklistService } from "./checklist.service";
import { SurgeryController } from "./surgery.controller";
import { SurgeryService } from "./surgery.service";

@Module({
  imports: [IdentityModule],
  controllers: [SurgeryController],
  providers: [SurgeryService, ChecklistService],
  exports: [SurgeryService, ChecklistService],
})
export class SurgeryModule {}
