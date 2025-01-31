/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  PerformRuleInstallationResponseBody,
  PERFORM_RULE_INSTALLATION_URL,
} from '@kbn/security-solution-plugin/common/api/detection_engine';
import { ELASTIC_SECURITY_RULE_ID } from '@kbn/security-solution-plugin/common/detection_engine/constants';
import type { PrePackagedRulesStatusResponse } from '@kbn/security-solution-plugin/public/detection_engine/rule_management/logic/types';
import { getPrebuiltRuleWithExceptionsMock } from '@kbn/security-solution-plugin/server/lib/detection_engine/prebuilt_rules/mocks';
import { createRuleAssetSavedObject } from '../../helpers/rules';

export const getPrebuiltRulesStatus = () => {
  return cy.request<PrePackagedRulesStatusResponse>({
    method: 'GET',
    url: 'api/detection_engine/rules/prepackaged/_status',
    headers: {
      'kbn-xsrf': 'cypress-creds',
      'x-elastic-internal-origin': 'security-solution',
      'elastic-api-version': '2023-10-31',
    },
  });
};

export const SAMPLE_PREBUILT_RULE = createRuleAssetSavedObject({
  ...getPrebuiltRuleWithExceptionsMock(),
  rule_id: ELASTIC_SECURITY_RULE_ID,
  tags: ['test-tag-1'],
  enabled: true,
});

/* Install all prebuilt rules available as security-rule saved objects
 * Use in combination with `preventPrebuiltRulesPackageInstallation` and
 * `createNewRuleAsset` to create mocked prebuilt rules and install only those
 * instead of all rules available in the `security_detection_engine` package
 */
export const installAllPrebuiltRulesRequest = () =>
  cy.request<PerformRuleInstallationResponseBody>({
    method: 'POST',
    url: PERFORM_RULE_INSTALLATION_URL,
    headers: {
      'kbn-xsrf': 'cypress-creds',
      'x-elastic-internal-origin': 'security-solution',
      'elastic-api-version': '1',
    },
    body: {
      mode: 'ALL_RULES',
    },
  });

export const getAvailablePrebuiltRulesCount = () => {
  cy.log('Get prebuilt rules count');
  return getPrebuiltRulesStatus().then(({ body }) => {
    const prebuiltRulesCount = body.rules_installed + body.rules_not_installed;

    return prebuiltRulesCount;
  });
};

export const waitTillPrebuiltRulesReadyToInstall = () => {
  cy.waitUntil(
    () => {
      return getAvailablePrebuiltRulesCount().then((availablePrebuiltRulesCount) => {
        return availablePrebuiltRulesCount > 0;
      });
    },
    { interval: 2000, timeout: 60000 }
  );
};

/**
 * Install all prebuilt rules.
 *
 * This is a heavy request and should be used with caution. Most likely you
 * don't need all prebuilt rules to be installed, crating just a few prebuilt
 * rules should be enough for most cases.
 */
export const excessivelyInstallAllPrebuiltRules = () => {
  cy.log('Install prebuilt rules (heavy request)');
  waitTillPrebuiltRulesReadyToInstall();
  installAllPrebuiltRulesRequest();
};

export const createNewRuleAsset = ({
  index = '.kibana_security_solution',
  rule = SAMPLE_PREBUILT_RULE,
}: {
  index?: string;
  rule?: typeof SAMPLE_PREBUILT_RULE;
}) => {
  const url = `${Cypress.env('ELASTICSEARCH_URL')}/${index}/_doc/security-rule:${
    rule['security-rule'].rule_id
  }?refresh`;
  cy.log('URL', url);
  cy.waitUntil(
    () => {
      return cy
        .request({
          method: 'PUT',
          url,
          headers: {
            'kbn-xsrf': 'cypress-creds',
            'x-elastic-internal-origin': 'security-solution',
            'Content-Type': 'application/json',
          },
          failOnStatusCode: false,
          body: rule,
        })
        .then((response) => response.status === 200);
    },
    { interval: 500, timeout: 12000 }
  );
};

export const bulkCreateRuleAssets = ({
  index = '.kibana_security_solution',
  rules = [SAMPLE_PREBUILT_RULE],
}: {
  index?: string;
  rules?: Array<typeof SAMPLE_PREBUILT_RULE>;
}) => {
  const url = `${Cypress.env('ELASTICSEARCH_URL')}/${index}/_bulk`;

  const bulkIndexRequestBody = rules.reduce((body, rule) => {
    const indexOperation = {
      index: {
        _index: index,
        _id: rule['security-rule'].rule_id,
      },
    };

    const documentData = JSON.stringify(rule);

    return body.concat(JSON.stringify(indexOperation), '\n', documentData, '\n');
  }, '');

  cy.request({
    method: 'PUT',
    url: `${Cypress.env('ELASTICSEARCH_URL')}/${index}/_mapping?refresh`,
    body: {
      dynamic: true,
    },
    headers: {
      'Content-Type': 'application/json',
      'x-elastic-internal-origin': 'security-solution',
    },
  });

  cy.waitUntil(
    () => {
      return cy
        .request({
          method: 'POST',
          url,
          headers: {
            'kbn-xsrf': 'cypress-creds',
            'x-elastic-internal-origin': 'security-solution',
            'Content-Type': 'application/json',
          },
          failOnStatusCode: false,
          body: bulkIndexRequestBody,
        })
        .then((response) => response.status === 200);
    },
    { interval: 500, timeout: 12000 }
  );
};

export const getRuleAssets = (index: string | undefined = '.kibana_security_solution') => {
  const url = `${Cypress.env('ELASTICSEARCH_URL')}/${index}/_search?size=10000`;
  return cy.request({
    method: 'GET',
    url,
    headers: {
      'kbn-xsrf': 'cypress-creds',
      'x-elastic-internal-origin': 'security-solution',
      'Content-Type': 'application/json',
    },
    failOnStatusCode: false,
    body: {
      query: {
        term: { type: { value: 'security-rule' } },
      },
    },
  });
};

/* Prevent the installation of the `security_detection_engine` package from Fleet
/* by intercepting the request and returning a mock empty object as response
/* Used primarily to prevent the unwanted installation of "real" prebuilt rules
/* during e2e tests, and allow for manual installation of mock rules instead. */
export const preventPrebuiltRulesPackageInstallation = () => {
  cy.intercept('POST', '/api/fleet/epm/packages/_bulk*', {});
  cy.intercept('POST', '/api/fleet/epm/packages/security_detection_engine/*', {});
};

/**
 * Install prebuilt rule assets. After installing these assets become available to be installed
 * as prebuilt rules. Prebuilt rule assets can be generated via `createRuleAssetSavedObject()` helper function.
 *
 * It's also important to take into account that business logic tries to fetch prebuilt rules Fleet package
 * and you need to add `preventPrebuiltRulesPackageInstallation()` to `beforeEach` section (before visit commands)
 * to avoid actually pulling a real Fleet package and have only provided prebuilt rule assets for testing.
 */
export const installPrebuiltRuleAssets = (ruleAssets: Array<typeof SAMPLE_PREBUILT_RULE>): void => {
  cy.log('Create mocked available to install prebuilt rules', ruleAssets.length);
  preventPrebuiltRulesPackageInstallation();
  // TODO: use this bulk method once the issue with Cypress is fixed
  // bulkCreateRuleAssets({ rules });
  ruleAssets.forEach((rule) => {
    createNewRuleAsset({ rule });
  });
};

/**
 * Prevent the installation of the `security_detection_engine` package from Fleet.
 * The create a `security-rule` asset for each rule provided in the `rules` array.
 * Optionally install the rules to Kibana, with a flag defaulting to true
 * Explicitly set the `installToKibana` flag to false in cases when needing to
 * make mock rules available for installation or update, but do those operations manually
 *
 * * @param {Array} rules - Rule assets to be created and optionally installed
 *
 * * @param {string} installToKibana - Flag to decide whether to install the rules as 'alerts' SO. Defaults to true.
 */
export const createAndInstallMockedPrebuiltRules = ({
  rules: ruleAssets,
  installToKibana = true,
}: {
  rules: Array<typeof SAMPLE_PREBUILT_RULE>;
  installToKibana?: boolean;
}) => {
  installPrebuiltRuleAssets(ruleAssets);

  if (installToKibana) {
    cy.log('Install prebuilt rules', ruleAssets.length);
    return installAllPrebuiltRulesRequest();
  }
};
