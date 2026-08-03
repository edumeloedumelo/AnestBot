import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { OrganizationController, TenantsController } from "./organization.controller";
import { OrganizationService } from "./organization.service";

@Module({
  imports: [IdentityModule],
  controllers: [OrganizationController, TenantsController],
  providers: [OrganizationService],
  exports: [OrganizationService],
})
export class OrganizationModule {}
