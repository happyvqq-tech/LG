// 文言文十八個核心虛詞的用法分類
// 這是標準的文言文教學知識（等同於各版本高中國文課本、大學國學導論的
// 虛詞表），屬穩定的語言學共識，不是需要逐字校對來源的「原文引用」。
//
// 練習時會從《古文觀止》真實語料抽出含該虛詞的句子（見 particleCorpus.ts），
// 再請 AI 判斷「這一句裡，此字屬於下面哪一種用法」——AI 只能從這裡列出的
// 固定分類中選，回應會被驗證，選到列表外的一律捨棄。

export interface ParticleSense {
  id: string
  /** 簡短標籤，選項按鈕上顯示 */
  label: string
  /** 白話說明 */
  desc: string
}

export interface ParticleEntry {
  word: string
  senses: ParticleSense[]
}

export const CLASSICAL_PARTICLES: ParticleEntry[] = [
  {
    word: '之',
    senses: [
      { id: 'zhi_pronoun', label: '代詞', desc: '代替人、事、物，「他／她／它／這／此」' },
      { id: 'zhi_de', label: '助詞「的」', desc: '定語＋之＋中心語，相當於「的」' },
      { id: 'zhi_verb', label: '動詞「往」', desc: '「到、去」某處' },
      { id: 'zhi_cancel', label: '取消句子獨立性', desc: '用在主詞和謂語之間，讓子句變成句子成分，不必翻譯出來' },
      { id: 'zhi_frontobj', label: '賓語前置標誌', desc: '把提前的賓語跟動詞隔開，如「何陋之有」' },
    ],
  },
  {
    word: '何',
    senses: [
      { id: 'he_what', label: '疑問代詞「什麼」', desc: '作賓語或主語，問人事物' },
      { id: 'he_why', label: '疑問副詞「為什麼」', desc: '問原因，「怎麼、為何」' },
      { id: 'he_degree', label: '表程度「多麼」', desc: '如「何其」，感嘆程度之深' },
    ],
  },
  {
    word: '乎',
    senses: [
      { id: 'hu_question', label: '疑問語氣詞', desc: '句末表疑問，相當於「嗎、呢」' },
      { id: 'hu_exclaim', label: '感嘆語氣詞', desc: '句末表感嘆，相當於「啊」' },
      { id: 'hu_at', label: '介詞，同「於」', desc: '表處所、對象，如「生乎吾前」＝生於吾前' },
      { id: 'hu_suffix', label: '形容詞詞尾', desc: '接在形容詞後加強語氣，如「巍乎」' },
    ],
  },
  {
    word: '乃',
    senses: [
      { id: 'nai_then', label: '副詞「於是、就」', desc: '順接上文，表示接著發生' },
      { id: 'nai_unexpect', label: '副詞「竟然、卻」', desc: '表示出乎意料' },
      { id: 'nai_only', label: '副詞「才」', desc: '強調條件才成立，如「乃入見」' },
      { id: 'nai_is', label: '判斷詞「是」', desc: '「此乃…」句型，等同「這就是」' },
      { id: 'nai_you', label: '代詞「你、你的」', desc: '第二人稱' },
    ],
  },
  {
    word: '其',
    senses: [
      { id: 'qi_his_det', label: '代詞（定語）', desc: '「他的、它的」，修飾後面的名詞' },
      { id: 'qi_he_subj', label: '代詞（主語）', desc: '「他、它」，作句子主詞' },
      { id: 'qi_that', label: '指示代詞「那」', desc: '「那個、那些」' },
      { id: 'qi_modal', label: '語氣副詞', desc: '表推測、反問或期望，如「豈、大概、還是」' },
    ],
  },
  {
    word: '且',
    senses: [
      { id: 'qie_and', label: '連詞「而且」', desc: '並列或遞進，「並且、況且」' },
      { id: 'qie_about', label: '副詞「將要」', desc: '「快要、將近」' },
      { id: 'qie_forNow', label: '副詞「暫且」', desc: '「姑且、先」' },
      { id: 'qie_evenSo', label: '連詞「尚且」', desc: '讓步，帶出更進一層的意思' },
    ],
  },
  {
    word: '若',
    senses: [
      { id: 'ruo_if', label: '連詞「如果」', desc: '「假如、要是」，帶出假設' },
      { id: 'ruo_like', label: '動詞「像」', desc: '「如同、好像」' },
      { id: 'ruo_you', label: '代詞「你」', desc: '第二人稱，「你、你的」' },
      { id: 'ruo_opener', label: '發語詞', desc: '如「若夫」「至若」，用來另起一段話題' },
    ],
  },
  {
    word: '所',
    senses: [
      { id: 'suo_struct', label: '所字結構', desc: '「所＋動詞」指代動作的對象，「…的人／事／物」' },
      { id: 'suo_passive', label: '「為…所…」表被動', desc: '與「為」搭配構成被動句' },
      { id: 'suo_reason', label: '「所以」表原因／方法', desc: '固定搭配，帶出原因或用來做某事的方法' },
    ],
  },
  {
    word: '為',
    senses: [
      { id: 'wei_do', label: '動詞「做、成為」', desc: '「做、擔任、成為」' },
      { id: 'wei_for', label: '介詞「替、為了」', desc: '去聲，「替、為了」' },
      { id: 'wei_passive', label: '介詞，表被動「被」', desc: '常與「所」搭配「為…所…」' },
      { id: 'wei_qmark', label: '句末疑問語氣詞', desc: '用於「何…為」，反問「做什麼」' },
    ],
  },
  {
    word: '焉',
    senses: [
      { id: 'yan_yuzhi', label: '兼詞「於之／於此」', desc: '相當於介詞＋代詞，「在這裡、對此」' },
      { id: 'yan_where', label: '疑問代詞「哪裡」', desc: '「怎麼、哪裡」' },
      { id: 'yan_modal', label: '句末語氣詞', desc: '加強語氣，「了、啊」' },
      { id: 'yan_it', label: '代詞「它」', desc: '指代前文提到的事物' },
    ],
  },
  {
    word: '也',
    senses: [
      { id: 'ye_judge', label: '判斷句句末語氣詞', desc: '表判斷、肯定，「…也」句型的核心標誌' },
      { id: 'ye_pause', label: '句中語氣詞', desc: '用在句子中間表停頓' },
      { id: 'ye_question', label: '疑問／反問語氣詞', desc: '句末表疑問或反問' },
    ],
  },
  {
    word: '以',
    senses: [
      { id: 'yi_use', label: '介詞「用、拿」', desc: '表憑藉的工具或方式' },
      { id: 'yi_because', label: '介詞「因為」', desc: '表原因' },
      { id: 'yi_and', label: '連詞，同「而」', desc: '連接前後兩個動作' },
      { id: 'yi_think', label: '動詞「認為」', desc: '常見於「以為」固定搭配' },
    ],
  },
  {
    word: '因',
    senses: [
      { id: 'yin_because', label: '介詞「因為、由於」', desc: '表原因' },
      { id: 'yin_via', label: '介詞「趁著、憑藉」', desc: '表憑藉的機會或條件' },
      { id: 'yin_thus', label: '連詞「於是、因此」', desc: '表結果' },
      { id: 'yin_follow', label: '動詞「沿襲、依照」', desc: '「因循、依照舊例」' },
    ],
  },
  {
    word: '於',
    senses: [
      { id: 'yu_place', label: '介詞，表處所「在」', desc: '「在…」' },
      { id: 'yu_object', label: '介詞，表對象「對、向」', desc: '「對、向、給」' },
      { id: 'yu_compare', label: '介詞，表比較「比」', desc: '「比…（更）」' },
      { id: 'yu_passive', label: '介詞，表被動「被」', desc: '「被」' },
    ],
  },
  {
    word: '與',
    senses: [
      { id: 'yu3_and', label: '連詞「和、跟」', desc: '連接並列的人事物' },
      { id: 'yu3_with', label: '介詞「跟…（一起）」', desc: '表共同動作的對象' },
      { id: 'yu3_give', label: '動詞「給予」', desc: '「給、給予」' },
      { id: 'yu3_question', label: '疑問語氣詞', desc: '同「歟」，句末表疑問' },
    ],
  },
  {
    word: '則',
    senses: [
      { id: 'ze_then', label: '連詞，表順承「就」', desc: '「便、就」' },
      { id: 'ze_but', label: '連詞，表轉折「卻」', desc: '「然而、卻」' },
      { id: 'ze_ifthen', label: '連詞，表條件「那麼」', desc: '假設或條件關係' },
      { id: 'ze_rule', label: '名詞「準則」', desc: '「規則、法則」' },
    ],
  },
  {
    word: '者',
    senses: [
      { id: 'zhe_struct', label: '者字結構', desc: '與動詞／形容詞組成「…的人、…的事」' },
      { id: 'zhe_pause', label: '判斷句主語後停頓', desc: '用在判斷句主詞後，標示停頓' },
      { id: 'zhe_time', label: '時間詞後綴', desc: '如「今者」，接在時間詞後' },
    ],
  },
  {
    word: '而',
    senses: [
      { id: 'er_and', label: '連詞，表並列「並且」', desc: '「並且、又」' },
      { id: 'er_then', label: '連詞，表承接「然後」', desc: '「然後、接著就」' },
      { id: 'er_but', label: '連詞，表轉折「卻」', desc: '「但是、卻」' },
      { id: 'er_modify', label: '連詞，表修飾', desc: '連接狀語與中心語，不必譯出' },
    ],
  },
]

export const CLASSICAL_PARTICLE_WORDS = CLASSICAL_PARTICLES.map((p) => p.word)

export function getParticleEntry(word: string): ParticleEntry | undefined {
  return CLASSICAL_PARTICLES.find((p) => p.word === word)
}
