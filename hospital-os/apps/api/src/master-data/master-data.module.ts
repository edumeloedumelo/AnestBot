import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { InsurersService } from "./insurers.service";
import { MasterDataController } from "./master-data.controller";
import { ProceduresService } from "./procedures.service";

@Module({
  imports: [IdentityModule],
  controllers: [MasterDataController],
  providers: [ProceduresService, InsurersService],
  exports: [ProceduresService, InsurersService],
})
export class MasterDataModule {}
