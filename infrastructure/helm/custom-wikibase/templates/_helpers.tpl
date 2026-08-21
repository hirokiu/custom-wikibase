{{- define "custom-wikibase.labels" -}}
app.kubernetes.io/name: custom-wikibase
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
custom-wikibase.org/profile: {{ .Values.profile | quote }}
{{- end }}
{{- define "custom-wikibase.selector" -}}
app.kubernetes.io/name: custom-wikibase
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}
{{- define "custom-wikibase.image" -}}
{{- if .digest -}}
{{ printf "%s:%s@%s" .repository .tag .digest }}
{{- else -}}
{{ printf "%s:%s" .repository .tag }}
{{- end -}}
{{- end }}
{{- define "custom-wikibase.storageClass" -}}
{{- if .Values.storage.className }}
storageClassName: {{ .Values.storage.className | quote }}
{{- end }}
{{- end }}
