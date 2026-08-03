import { Module } from "@nestjs/common";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AnesthesiaModule } from "./anesthesia/anesthesia.module";
import { AuditModule } from "./audit/audit.module";
import { DbModule } from "./db/db.module";
import { IdentityModule } from "./identity/identity.module";
import { MasterDataModule } from "./master-data/master-data.module";
import { OrganizationModule } from "./organization/organization.module";
import { PatientsModule } from "./patients/patients.module";
import { SurgeryModule } from "./surgery/surgery.module";

@Module({
  imports: [
    DbModule,
    AuditModule,
    IdentityModule,
    OrganizationModule,
    PatientsModule,
    MasterDataModule,
    SurgeryModule,
    AnesthesiaModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
