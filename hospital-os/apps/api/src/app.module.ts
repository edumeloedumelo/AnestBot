import { Module } from "@nestjs/common";
import { AuditModule } from "./audit/audit.module";
import { DbModule } from "./db/db.module";
import { IdentityModule } from "./identity/identity.module";
import { OrganizationModule } from "./organization/organization.module";
import { PatientsModule } from "./patients/patients.module";

@Module({
  imports: [DbModule, AuditModule, IdentityModule, OrganizationModule, PatientsModule],
})
export class AppModule {}
