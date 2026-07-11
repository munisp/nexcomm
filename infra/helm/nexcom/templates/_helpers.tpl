{{/*
NEXCOM Exchange — Helm template helpers
*/}}

{{/* Expand the name of the chart */}}
{{- define "nexcom.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Create a default fully qualified app name */}}
{{- define "nexcom.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/* Chart label */}}
{{- define "nexcom.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Common labels */}}
{{- define "nexcom.labels" -}}
helm.sh/chart: {{ include "nexcom.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: nexcom-exchange
{{- end }}

{{/* Selector labels for a given service name */}}
{{- define "nexcom.selectorLabels" -}}
app: {{ .name }}
app.kubernetes.io/name: {{ .name }}
{{- end }}

{{/* Common pod annotations */}}
{{- define "nexcom.podAnnotations" -}}
{{- if .dapr.enabled }}
dapr.io/enabled: "true"
dapr.io/app-id: {{ .name | quote }}
dapr.io/app-port: {{ .dapr.appPort | quote }}
{{- end }}
{{- if .prometheus.scrape }}
prometheus.io/scrape: "true"
prometheus.io/port: {{ .prometheus.port | quote }}
prometheus.io/path: {{ .prometheus.path | quote }}
{{- end }}
{{- end }}

{{/* Service account name */}}
{{- define "nexcom.serviceAccountName" -}}
{{ .Values.global.serviceAccountName }}
{{- end }}
