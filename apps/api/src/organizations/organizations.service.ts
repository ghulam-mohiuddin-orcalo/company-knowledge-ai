import { Injectable } from '@nestjs/common';
import {
  type OrganizationRecord,
  OrganizationsRepository,
  type OrganizationStatus,
} from './organizations.repository.js';

export const ORGANIZATION_NAME_MAX_LENGTH = 200;

export class InvalidOrganizationNameError extends Error {
  constructor() {
    super(
      `Organization name must be 1-${ORGANIZATION_NAME_MAX_LENGTH} characters.`,
    );
    this.name = 'InvalidOrganizationNameError';
  }
}

@Injectable()
export class OrganizationsService {
  constructor(private readonly organizations: OrganizationsRepository) {}

  async createOrganization(name: string): Promise<OrganizationRecord> {
    const trimmed = name.trim();
    if (trimmed === '' || trimmed.length > ORGANIZATION_NAME_MAX_LENGTH) {
      throw new InvalidOrganizationNameError();
    }
    return this.organizations.create({ name: trimmed });
  }

  async setStatus(
    organizationId: string,
    status: OrganizationStatus,
  ): Promise<void> {
    await this.organizations.setStatus(organizationId, status);
  }
}
