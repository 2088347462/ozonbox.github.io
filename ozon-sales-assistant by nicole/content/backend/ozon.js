// Ozon Sales Assistant Plugin
// Clean and readable implementation

(function() {
    'use strict';

    class OzonSalesAssistant {
        constructor() {
            this.sysLang = this.getCookie('x-o3-language') || 'zh';
            this.init();
        }

        // Cookie management
        setCookie(name, value, expires = 0, domain = '') {
            let expireStr = '';
            if (expires) {
                expireStr = ';expires=' + expires;
            }
            if (domain) {
                domain = ';domain=' + domain;
            }
            document.cookie = name + '=' + escape(value) + expireStr + domain;
        }

        getCookie(name) {
            if (document.cookie.length > 0) {
                let start = document.cookie.indexOf(name + '=');
                if (start !== -1) {
                    start = start + name.length + 1;
                    let end = document.cookie.indexOf(';', start);
                    if (end === -1) end = document.cookie.length;
                    return unescape(document.cookie.substring(start, end));
                }
            }
            return '';
        }

        // Initialize the plugin
        init() {
            if (this.setupAutoRedirect()) {
                return false;
            }
            this.createXHRInterceptor();
            this.createFetchInterceptor();
            this.createCommonModal();
        }

        // Check if we need to redirect from graphs page
        checkAnalyticsGraphs() {
            if (!new RegExp('/analytics/graphs', 'i').test(location.pathname)) {
                return false;
            }
            
            const blurredCells = document.querySelectorAll('td.index___td_halign_right_1Pqeg.index___td_uUKmN.index__has-background_tOH5o span.styles_total_wyroi.styles_blurredCell_5Qe0j');
            if (blurredCells.length > 0) {
                console.log('检测到OZON卖家后台分析报表高斯模糊单元格');
                sessionStorage.setItem('sf_ozon_from_graphs', 'true');
                sessionStorage.setItem('sf_ozon_original_path', location.pathname);
                history.pushState(null, '', 'https://seller.ozon.ru/app/analytics');
                location.search = '?sf_ozon_force_refresh=' + Date.now();
                return true;
            }
            return false;
        }

        // Check competitive position page
        checkCompetitiveCells() {
            if (!new RegExp('/analytics/what-to-sell/competitive-position', 'i').test(location.pathname)) {
                return false;
            }
            
            console.log('进入OZON卖家后台竞争地位页面');
            sessionStorage.setItem('sf_ozon_from_graphs', 'true');
            sessionStorage.setItem('sf_ozon_original_path', location.pathname);
            history.pushState(null, '', 'https://seller.ozon.ru/app/analytics/what-to-sell/categories-comparison');
            location.search = '?sf_ozon_force_refresh=' + Date.now();
            return true;
        }

        // Setup auto redirect logic
        setupAutoRedirect() {
            if (new RegExp('/analytics/graphs', 'i').test(location.pathname)) {
                console.log('开始检查分析报表模糊单元格');
                return this.checkAnalyticsGraphs();
            }
            
            if (new RegExp('/analytics$', 'i').test(location.pathname) && 
                location.search.includes('sf_ozon_force_refresh')) {
                console.log('已在OZON卖家后台分析页面，安装拦截器');
                this.createXHRInterceptor();
                this.createFetchInterceptor();
                return true;
            }
            
            return false;
        }

        // Create XHR interceptor
        createXHRInterceptor() {
            const originalXHR = window.XMLHttpRequest;
            const self = this;

            class InterceptedXHR extends originalXHR {
                constructor() {
                    super();
                    this.ozUrl = '';
                    this.ozIntercepted = false;
                }

                open(method, url) {
                    this.ozUrl = url;
                    return super.open(method, url);
                }

                send(data) {
                    const interceptPatterns = [
                        new RegExp('/premium/status', 'i'),
                        new RegExp('/statistics/data', 'i'),
                        new RegExp('/graph/data', 'i'),
                        new RegExp('/analytics/graphs', 'i'),
                        new RegExp('/analytics$', 'i'),
                        new RegExp('seller-analytics/premium/status', 'i')
                    ];

                    const shouldIntercept = interceptPatterns.some(pattern => pattern.test(this.ozUrl));

                    if (shouldIntercept) {
                        console.log('拦截URL:', this.ozUrl);
                        this.ozIntercepted = true;
                        
                        const mockResponse = self.refactorResponse(this.ozUrl);
                        
                        // Mock the response
                        Object.defineProperties(this, {
                            'responseText': { value: mockResponse },
                            'response': { value: mockResponse },
                            'status': { value: 200 },
                            'statusText': { value: 'OK' },
                            'readyState': { 
                                get: () => this.ozIntercepted ? 4 : super.readyState 
                            }
                        });

                        // Trigger events asynchronously
                        Promise.resolve().then(() => {
                            if (typeof this.onreadystatechange === 'function') {
                                this.onreadystatechange(new Event('readystatechange'));
                            }
                            if (typeof this.onload === 'function') {
                                this.onload(new Event('load'));
                            }
                            this.dispatchEvent(new Event('load'));
                            this.dispatchEvent(new Event('loadend'));
                        });

                        // Handle premium status redirect
                        if (new RegExp('seller-analytics/premium/status', 'i').test(this.ozUrl)) {
                            setTimeout(() => {
                                history.pushState(null, '', 'https://seller.ozon.ru/app/analytics/graphs');
                                window.dispatchEvent(new PopStateEvent('popstate'));
                                setTimeout(() => {
                                    const customEvent = new CustomEvent('sf-ozon-extension-trigger');
                                    window.dispatchEvent(customEvent);
                                }, 100);
                            }, 1000);
                        }
                    }

                    return super.send(data);
                }
            }

            try {
                window.XMLHttpRequest = InterceptedXHR;
                if (window.XMLHttpRequest.prototype !== InterceptedXHR.prototype) {
                    Object.setPrototypeOf(window.XMLHttpRequest, InterceptedXHR);
                }
                console.log('XHR深度拦截安装成功');
                return true;
            } catch (error) {
                console.log('XHR拦截失败:', error);
                return false;
            }
        }

        // Create Fetch interceptor
        createFetchInterceptor() {
            const originalFetch = window.fetch;
            const self = this;

            window.fetch = async (input, init) => {
                const url = (input instanceof Request ? input.url : input) || '';
                
                const interceptPatterns = [
                    new RegExp('/premium/status', 'i'),
                    new RegExp('seller-analytics/premium/status', 'i'),
                    new RegExp('/graph/data', 'i'),
                    new RegExp('/analytics/graphs', 'i'),
                    new RegExp('/analytics$', 'i'),
                    new RegExp('seller-analytics/premium/status', 'i')
                ];

                const shouldIntercept = interceptPatterns.some(pattern => pattern.test(url));

                if (shouldIntercept) {
                    console.log('深度拦截Fetch Url:', url);
                    return new Response(
                        JSON.stringify(self.refactorResponse(url)),
                        {
                            status: 200,
                            headers: {
                                'Content-Type': 'application/json',
                                'X-Intercepted': 'true'
                            }
                        }
                    );
                }

                try {
                    return await originalFetch(input, init);
                } catch (error) {
                    console.log('Fetch请求失败:', error);
                    throw error;
                }
            };

            console.log('Fetch深度拦截安装成功');
            return true;
        }

        // Generate mock response data
        refactorResponse(url) {
            const baseResponse = {
                status: 'grace_good',
                is_premium: true,
                is_premium_plus: true,
                isAnalyst: true,
                subscription: {
                    current: 'PREMIUM_PLUS',
                    available: ['PREMIUM_PLUS'],
                    grace_period_end_at: new Date(Date.now() + 157680000000).toISOString()
                },
                features: {
                    analytics: 'full',
                    marketing: 'full',
                    api: 'FULL',
                    graphs: 'full',
                    reports: 'full',
                    statistics: 'full',
                    recommendations: 'full'
                }
            };

            if (new RegExp('/statistics/data', 'i').test(url)) {
                return {
                    ...baseResponse,
                    dataPoints: Array.from({ length: 15 }, (_, index) => ({
                        id: 'metric_' + index,
                        value: Math.floor(Math.random() * 1000),
                        trend: Math.random() > 0.5 ? 'up' : 'down',
                        change: Math.floor(Math.random() * 100)
                    })),
                    hasAccess: true,
                    accessLevel: 'full_access'
                };
            }

            if (new RegExp('/analytics/graphs', 'i').test(url) || 
                new RegExp('/analytics$', 'i').test(url)) {
                return {
                    ...baseResponse,
                    graphsAccess: true,
                    dataSets: ['sales', 'traffic', 'conversion'],
                    timeRanges: ['day', 'week', 'month']
                };
            }

            return baseResponse;
        }

        // Create common modal
        createCommonModal() {
            const modal = $('<div>', {
                'class': 'modal fade',
                'id': 'common-modal',
                'tabindex': '-1',
                'role': 'dialog',
                'aria-labelledby': 'common-modal'
            }).append(
                $('<div>', { 'class': 'modal-dialog modal-dialog-centered' }).append(
                    $('<div>', { 'class': 'modal-content', 'style': 'border-top: none;' }).append(
                        $('<div>', { 'class': 'modal-header', 'style': 'line-height: 2' }).append(
                            $('<button>', {
                                'type': 'button',
                                'class': 'close',
                                'data-dismiss': 'modal',
                                'aria-hidden': true,
                                'style': 'border-bottom: none;'
                            }).html('&times;'),
                            $('<h2>', { 'class': 'modal-title text-center', 'style': 'font-size: 35px' })
                        ),
                        $('<div>', { 'class': 'modal-body', 'style': 'text-start' }),
                        $('<div>', { 'class': 'modal-footer', 'style': 'line-height: 2;' })
                    )
                )
            );

            $('body').append(modal);
        }

        // Show success modal
        showSuccessModal(title, content, footer) {
            const modal = $('#common-modal');
            modal.find('.modal-title')
                .removeClass('text-start')
                .addClass('text-center')
                .html(title);
            modal.find('.modal-body')
                .removeClass('text-start')
                .addClass('text-center')
                .html(content);
            modal.find('.modal-footer')
                .removeClass('text-end')
                .addClass('text-center')
                .html(footer);
            modal.modal('show');
        }

        // Show modal tips
        showModalTips(title, content, footer) {
            const modal = $('#common-modal');
            modal.find('.modal-title')
                .removeClass('text-center')
                .addClass('text-start')
                .html(title);
            modal.find('.modal-body')
                .removeClass('text-center')
                .addClass('text-start')
                .html(content);
            modal.find('.modal-footer')
                .removeClass('text-center')
                .addClass('text-end')
                .html(footer);
            modal.modal('show');
        }

        // Show modal content
        showModalContent() {
            const fromGraphs = sessionStorage.getItem('sf_ozon_from_graphs');
            const hasRefresh = location.search.includes('sf_ozon_force_refresh');
            
            if (!hasRefresh || !fromGraphs) {
                console.log('非拦截器访问，不弹窗');
                return;
            }

            const title = '';
            const content = '';
            const footer = '<button class="btn btn-primary modal-action">确定</button>';
            
            this.showSuccessModal(title, content, footer);
            
            $('.modal-action').off('click').on('click', function() {
                $('#common-modal').modal('hide');
                history.pushState(null, '', 'https://seller.ozon.ru/app/analytics/graphs');
                window.dispatchEvent(new PopStateEvent('popstate'));
                setTimeout(() => {
                    const customEvent = new CustomEvent('sf-ozon-extension-trigger');
                    window.dispatchEvent(customEvent);
                }, 100);
            });
        }

        // Start the plugin
        start() {
            this.init();
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', this.showModalContent, { once: true });
            }
        }
    }

    // Initialize when jQuery is ready
    $(function() {
        const ozonAssistant = new OzonSalesAssistant();
    });

})();