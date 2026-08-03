import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { areaList } from '@vant/area-data';
import { AppSelect, AppTextInput, type AppFieldSize } from './FormControls';

interface RegionSelectProps {
  /** 省市区齐全时回调「省+市+区 [+ 详细地址]」拼接字符串；地区未选齐回调空串 */
  onChange: (value: string) => void;
  fieldSize?: AppFieldSize;
  className?: string;
  disabled?: boolean;
}

/**
 * 中国省 / 市 / 区三级联动下拉 + 详细地址输入框。数据来自 @vant/area-data（民政部 6 位编码）。
 * 非受控（内部维护三级编码 + 详细文本），适合注册等新建场景。
 */
export default function RegionSelect({ onChange, fieldSize = 'lg', className = '', disabled }: RegionSelectProps) {
  const { t } = useTranslation();
  const [provinceCode, setProvinceCode] = useState('');
  const [cityCode, setCityCode] = useState('');
  const [countyCode, setCountyCode] = useState('');
  const [detail, setDetail] = useState('');

  const provinces = useMemo(() => Object.entries(areaList.province_list), []);
  const cities = useMemo(
    () =>
      provinceCode
        ? Object.entries(areaList.city_list).filter(([code]) => code.slice(0, 2) === provinceCode.slice(0, 2))
        : [],
    [provinceCode],
  );
  const counties = useMemo(
    () =>
      cityCode
        ? Object.entries(areaList.county_list).filter(([code]) => code.slice(0, 4) === cityCode.slice(0, 4))
        : [],
    [cityCode],
  );

  const regionReady = Boolean(provinceCode && cityCode && countyCode);

  function emit(p: string, c: string, ct: string, d: string) {
    if (p && c && ct) {
      const region = `${areaList.province_list[p] || ''}${areaList.city_list[c] || ''}${
        areaList.county_list[ct] || ''
      }`;
      onChange(d.trim() ? `${region}${d.trim()}` : region);
    } else {
      onChange('');
    }
  }

  return (
    <div className={className}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <AppSelect
          fieldSize={fieldSize}
          value={provinceCode}
          disabled={disabled}
          onChange={(e) => {
            const p = e.target.value;
            setProvinceCode(p);
            setCityCode('');
            setCountyCode('');
            emit(p, '', '', detail);
          }}
        >
          <option value="">省</option>
          {provinces.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </AppSelect>
        <AppSelect
          fieldSize={fieldSize}
          value={cityCode}
          disabled={disabled || !provinceCode}
          onChange={(e) => {
            const c = e.target.value;
            setCityCode(c);
            setCountyCode('');
            emit(provinceCode, c, '', detail);
          }}
        >
          <option value="">市</option>
          {cities.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </AppSelect>
        <AppSelect
          fieldSize={fieldSize}
          value={countyCode}
          disabled={disabled || !cityCode}
          onChange={(e) => {
            const ct = e.target.value;
            setCountyCode(ct);
            emit(provinceCode, cityCode, ct, detail);
          }}
        >
          <option value="">区</option>
          {counties.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </AppSelect>
      </div>
      <AppTextInput
        type="text"
        fieldSize={fieldSize}
        value={detail}
        disabled={disabled || !regionReady}
        onChange={(e) => {
          setDetail(e.target.value);
          emit(provinceCode, cityCode, countyCode, e.target.value);
        }}
        placeholder={t('auth.addressDetailPlaceholder')}
        className="mt-2"
      />
    </div>
  );
}
