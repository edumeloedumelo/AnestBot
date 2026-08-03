import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { AnesthesiaService } from "./anesthesia.service";

@Module({
  imports: [IdentityModule],
  providers: [AnesthesiaService],
  exports: [AnesthesiaService],
})
export class AnesthesiaModule {}
