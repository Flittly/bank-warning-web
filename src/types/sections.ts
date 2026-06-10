export interface SectionParams {
  param_name?: string;
  segment?: string;
  current_timepoint?: string;
  set_name?: string;
  water_qs?: string;
  tidal_level?: string;
  bench_id?: string;
  ref_id?: string;
  hs?: number;
  hc?: number;
  protection_level?: string;
  control_level?: string;
  comparison_timepoint?: string;
  risk_thresholds?: {
    Dsed?: number[];
    Zb?: number[];
    Sa?: number[];
    Ln?: number[];
    PQ?: number[];
    Ky?: number[];
    Zd?: number[];
    all?: number[];
  };
  weights?: {
    wRE?: number[];
    wNM?: number[];
    wGE?: number[];
    wRL?: number[];
  };
  other_params?: Record<string, any>;
}
