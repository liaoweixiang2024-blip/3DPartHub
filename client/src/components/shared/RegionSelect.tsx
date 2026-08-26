import { areaList } from '@vant/area-data';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppSelect, AppTextInput, type AppFieldSize } from './FormControls';

interface RegionSelectProps {
  /** 省市区齐全时回调「省+市+区 [+ 详细地址]」拼接字符串；地区未选齐回调空串 */
  onChange: (value: string) => void;
  fieldSize?: AppFieldSize;
  className?: string;
  disabled?: boolean;
  /**
   * 初始地址（受控入口的回显）：「省+市+区+详细」拼接字符串。传入后组件按名称反查三级编码回显；
   * 反查不出的前缀（历史手填地址）原样保留在详细框，用户可重新选择修正。
   * 不传则维持原有非受控行为（注册场景）。
   */
  initialAddress?: string;
}

/** 按名称反查省/市/区编码（area-data 名称唯一，倒排索引 O(1) 查找） */
function findRegionCodes(address: string): { province: string; city: string; county: string; rest: string } | null {
  const provinces = Object.entries(areaList.province_list);
  for (const [pCode, pName] of provinces) {
    if (!address.startsWith(pName)) continue;
    const afterProvince = address.slice(pName.length);
    const cities = Object.entries(areaList.city_list).filter(([code]) => code.slice(0, 2) === pCode.slice(0, 2));
    for (const [cCode, cName] of cities) {
      if (!afterProvince.startsWith(cName)) continue;
      const afterCity = afterProvince.slice(cName.length);
      const counties = Object.entries(areaList.county_list).filter(([code]) => code.slice(0, 4) === cCode.slice(0, 4));
      for (const [ctCode, ctName] of counties) {
        if (afterCity.startsWith(ctName)) {
          return { province: pCode, city: cCode, county: ctCode, rest: afterCity.slice(ctName.length) };
        }
      }
      // 省市匹配但区不匹配：可能是老数据区名变更，详细框保留剩余部分
      return { province: pCode, city: cCode, county: '', rest: afterCity };
    }
    // 省匹配但市不匹配：同样保留剩余
    return { province: pCode, city: '', county: '', rest: afterProvince };
  }
  return null;
}

/**
 * 中国省 / 市 / 区三级联动下拉 + 详细地址输入框。数据来自 @vant/area-data（民政部 6 位编码）。
 * 默认非受控（内部维护三级编码 + 详细文本），适合注册等新建场景；
 * 传 initialAddress 时在挂载时回显已有地址（个人设置编辑场景）。
 */
export default function RegionSelect({
  onChange,
  fieldSize = 'lg',
  className = '',
  disabled,
  initialAddress,
}: RegionSelectProps) {
  const { t } = useTranslation();
  // 回显：把已有「省市区+详细」字符串反解回三级编码 + 详细文本
  const restored = useMemo(() => {
    if (!initialAddress?.trim()) return { province: '', city: '', county: '', detail: '' };
    const found = findRegionCodes(initialAddress.trim());
    if (!found) return { province: '', city: '', county: '', detail: initialAddress.trim() };
    return { province: found.province, city: found.city, county: found.county, detail: found.rest };
    // 仅挂载时解析一次；用户操作后不再被外部值覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [provinceCode, setProvinceCode] = useState(restored.province);
  const [cityCode, setCityCode] = useState(restored.city);
  const [countyCode, setCountyCode] = useState(restored.county);
  const [detail, setDetail] = useState(restored.detail);

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
