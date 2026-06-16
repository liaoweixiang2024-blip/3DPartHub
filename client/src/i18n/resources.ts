import type { Resource } from 'i18next';
import { enUS } from './locales/en-US';
import {
  zhTWTranslation,
  jaJPTranslation,
  jaJPFrontOfficeTranslation,
  jaJPWorkflowTranslation,
  jaJPMajorFormsTranslation,
  jaJPMediaTranslation,
  jaJPCommunicationTranslation,
  jaJPAccessTranslation,
  koKRTranslation,
  koKRFrontOfficeTranslation,
  koKRWorkflowTranslation,
  koKRMajorFormsTranslation,
  koKRMediaTranslation,
  koKRCommunicationTranslation,
  koKRAccessTranslation,
  deDETranslation,
  deDEFrontOfficeTranslation,
  deDEWorkflowTranslation,
  deDEMajorFormsTranslation,
  deDEMediaTranslation,
  deDECommunicationTranslation,
  deDEAccessTranslation,
} from './locales/overrides';
import { zhCN } from './locales/zh-CN';
import { convertTranslationText, mergeTranslation, type TranslationMap } from './merge';

// 完整翻译：简体中文、英文直接内联；繁中/日/韩/德在英文（或简中）基础上合并覆盖片段。
export const resources: Resource = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

const englishTranslation = resources['en-US'].translation as TranslationMap;
const simplifiedChineseTranslation = resources['zh-CN'].translation as TranslationMap;

resources['zh-TW'] = {
  translation: mergeTranslation(convertTranslationText(simplifiedChineseTranslation), zhTWTranslation),
};
resources['ja-JP'] = {
  translation: mergeTranslation(
    mergeTranslation(
      mergeTranslation(mergeTranslation(englishTranslation, jaJPTranslation), jaJPFrontOfficeTranslation),
      jaJPWorkflowTranslation,
    ),
    mergeTranslation(
      mergeTranslation(mergeTranslation(jaJPMajorFormsTranslation, jaJPMediaTranslation), jaJPCommunicationTranslation),
      jaJPAccessTranslation,
    ),
  ),
};
resources['ko-KR'] = {
  translation: mergeTranslation(
    mergeTranslation(
      mergeTranslation(mergeTranslation(englishTranslation, koKRTranslation), koKRFrontOfficeTranslation),
      koKRWorkflowTranslation,
    ),
    mergeTranslation(
      mergeTranslation(mergeTranslation(koKRMajorFormsTranslation, koKRMediaTranslation), koKRCommunicationTranslation),
      koKRAccessTranslation,
    ),
  ),
};
resources['de-DE'] = {
  translation: mergeTranslation(
    mergeTranslation(
      mergeTranslation(mergeTranslation(englishTranslation, deDETranslation), deDEFrontOfficeTranslation),
      deDEWorkflowTranslation,
    ),
    mergeTranslation(
      mergeTranslation(mergeTranslation(deDEMajorFormsTranslation, deDEMediaTranslation), deDECommunicationTranslation),
      deDEAccessTranslation,
    ),
  ),
};
